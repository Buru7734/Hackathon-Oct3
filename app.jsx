import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// --- Configuration and Constants for Canvas Environment ---

const MODEL_NAME = 'gemini-2.5-flash-preview-05-20';
const MAX_RETRIES = 5;

// Use global variables provided by the Canvas environment for guaranteed stability.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// The API key is intentionally left empty here. In the Canvas environment, 
// the platform automatically provides the API key in the fetch call if it is not set.
const API_KEY = ""; 
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${API_KEY}`;

let firebaseConfig = {};
if (typeof __firebase_config !== 'undefined' && __firebase_config) {
  try {
    firebaseConfig = JSON.parse(__firebase_config);
  } catch (e) {
    console.error("Failed to parse Firebase config JSON from Canvas global.");
  }
}


// The main application component
const App = () => {
  // --- Firebase State and Initialization ---
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Initialize Firebase and Authentication
  useEffect(() => {
    try {
      if (Object.keys(firebaseConfig).length === 0) {
        console.warn("Firebase config is missing or invalid. Database functionality will be skipped.");
        setIsAuthReady(true);
        return;
      }
      
      const firebaseApp = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(firebaseApp);
      const firebaseAuth = getAuth(firebaseApp);

      setDb(firestoreDb);
      setAuth(firebaseAuth);

      const unsubscribe = onAuthStateChanged(firebaseAuth, async (user) => {
        if (!user) {
          // Use custom token if provided by Canvas environment
          if (initialAuthToken) {
            try {
              await signInWithCustomToken(firebaseAuth, initialAuthToken);
            } catch (error) {
              console.error("Error signing in with custom token. Falling back to anonymous sign-in:", error);
              await signInAnonymously(firebaseAuth);
            }
          } else {
            // Anonymous sign-in if no custom token is available
            await signInAnonymously(firebaseAuth);
          }
        }
        // User will be available after sign-in attempt
        setUserId(firebaseAuth.currentUser?.uid || crypto.randomUUID());
        setIsAuthReady(true);
      });

      return () => unsubscribe();
    } catch (error) {
      console.error("Failed to initialize Firebase:", error);
      setIsAuthReady(true); // Still allow app to run if Firebase fails
    }
  }, []); // Empty dependency array ensures this runs once

  // --- D&D App State ---
  const [partySize, setPartySize] = useState(4);
  const [averageLevel, setAverageLevel] = useState(5);
  const [difficulty, setDifficulty] = useState('Medium');
  const [terrain, setTerrain] = useState('Forest Ruin');
  const [flavor, setFlavor] = useState('A patrol guarding a magical artifact.');
  const [numEnemies, setNumEnemies] = useState(5); // NEW STATE for desired enemy count

  const [encounterOutput, setEncounterOutput] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [sources, setSources] = useState([]);
  const [error, setError] = useState(null);

  // Exponential Backoff for API calls
  const fetchWithBackoff = useCallback(async (url, options, retries = 0) => {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        if (response.status === 429 && retries < MAX_RETRIES) {
          const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
          console.log(`Rate limit exceeded. Retrying in ${Math.round(delay / 1000)}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return fetchWithBackoff(url, options, retries + 1);
        }
        throw new Error(`API call failed with status: ${response.status}`);
      }
      return response;
    } catch (e) {
      if (retries < MAX_RETRIES) {
        const delay = Math.pow(2, retries) * 1000 + Math.random() * 1000;
        console.log(`Fetch error. Retrying in ${Math.round(delay / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchWithBackoff(url, options, retries + 1);
      }
      throw new Error(`Fetch failed after ${MAX_RETRIES} retries: ${e.message}`);
    }
  }, []);

  const generateEncounter = useCallback(async (e) => {
    e.preventDefault();
    if (isLoading) return;
    
    setIsLoading(true);
    setEncounterOutput(null);
    setSources([]);
    setError(null);

    // --- UPDATED systemInstruction to explicitly include the enemy count constraint ---
    const systemInstruction = `You are an expert Dungeon Master (DM) and encounter designer for Dungeons & Dragons (D\&D). Use the latest D\&D 5th Edition rules and encounter building guidelines to accurately calculate and balance the combat difficulty.
        
        Task: Design a single combat encounter for the player party described below.
        1. Setting: Use the specified terrain.
        2. Difficulty: Strictly adhere to the requested difficulty level (${difficulty}).
        3. Monster Selection: Select specific, named D&D monsters (e.g., Goblin, Bugbear, Fire Elemental) appropriate for the setting and the calculated Challenge Rating (CR) budget. Do not invent new monsters. **The total quantity of all chosen monsters must equal the Desired Number of Enemies specified by the user.**
        4. Output Format:
           - Start with an engaging narrative hook describing the scene and the immediate threat.
           - Follow with a structured list detailing the specific monsters. For each monster, include:
             a. Monster Name and Quantity (bold the monster's name)
             b. Challenge Rating (CR)
             c. A concise Stat Block Summary listing key combat stats. Use a simple, un-emphasized bullet list for these stats to ensure clean formatting. Include: Armor Class (AC), Hit Points (HP), Speed, and its primary attack Action (Name, To Hit bonus, Damage, and effect). Example bullet point: "AC: 14 (Natural Armor), HP: 45 (6d8+18), Speed: 30 ft., Attack: Greatsword (+5 to hit, 1d10+3 slashing)"
           - Conclude with a note on why the encounter is balanced for the party using CR/XP math (briefly mention the adjusted XP threshold vs. encounter XP budget, referencing D&D 5e encounter rules).

        The response must be in plain markdown text.`;
    // --- END UPDATED systemInstruction ---

    const userQuery = `Generate a ${difficulty} combat encounter for a party of ${partySize} adventurers, with an average character level of ${averageLevel}.
        - Terrain: ${terrain}
        - Flavor/Context: ${flavor}
        - Desired Number of Enemies (Total Quantity): ${numEnemies}`; // NEW ENEMY COUNT IN QUERY

    const payload = {
      contents: [{ parts: [{ text: userQuery }] }],
      tools: [{ "google_search": {} }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      config: {
        temperature: 0.8,
      }
    };

    try {
      const response = await fetchWithBackoff(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const result = await response.json();
      const candidate = result.candidates?.[0];

      if (candidate && candidate.content?.parts?.[0]?.text) {
        const text = candidate.content.parts[0].text;
        setEncounterOutput(text);

        // Extract grounding sources
        let newSources = [];
        const groundingMetadata = candidate.groundingMetadata;
        if (groundingMetadata && groundingMetadata.groundingAttributions) {
          newSources = groundingMetadata.groundingAttributions
            .map(attribution => ({
              uri: attribution.web?.uri,
              title: attribution.web?.title,
            }))
            .filter(source => source.uri && source.title);
        }
        setSources(newSources);

      } else {
        setError("AI failed to generate content. Please try again with a different prompt.");
        console.error("API Error Response:", result);
      }
    } catch (e) {
      setError(e.message || "An unexpected error occurred during API communication.");
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [partySize, averageLevel, difficulty, terrain, flavor, numEnemies, fetchWithBackoff]); // Added numEnemies to dependencies

  const RenderMarkdown = ({ content }) => {
    if (!content) return null;
    // Simple conversion of markdown to JSX for display
    const lines = content.split('\n');
    return (
      <div className="prose prose-invert max-w-none text-gray-200">
        {lines.map((line, index) => {
          if (line.startsWith('## ')) {
            return <h2 key={index} className="text-xl font-bold text-yellow-400 mt-4 mb-2">{line.substring(3)}</h2>;
          }
          if (line.startsWith('### ')) {
            return <h3 key={index} className="text-lg font-semibold text-yellow-300 mt-3 mb-1">{line.substring(4)}</h3>;
          }
          
          // List item handling (Monsters and Stat Blocks)
          if (line.startsWith('* ') || line.startsWith('- ')) {
            // Check if the line contains a link (to avoid rendering text that looks like markdown links)
            let itemContent = line.substring(2).trim();
            
            // Basic bold rendering for list items (e.g., monster name)
            const parts = itemContent.split(/(\*\*.*?\*\*)/g).map((part, i) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                    return <strong key={i}>{part.substring(2, part.length - 2)}</strong>;
                }
                return part;
            });

            return <li key={index} className="list-disc ml-6 mt-1">{parts}</li>;
          }

          // General bold handling for paragraphs
          if (line.includes('**')) {
            const parts = line.split(/(\*\*.*?\*\*)/g).map((part, i) => {
                if (part.startsWith('**') && part.endsWith('**')) {
                    return <strong key={i}>{part.substring(2, part.length - 2)}</strong>;
                }
                return part;
            });
            return <p key={index} className="mb-2">{parts}</p>;
          }

          // Default paragraph
          if (line.trim().length > 0) {
              return <p key={index} className="mb-2">{line}</p>;
          }
          return null; // Ignore empty lines
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-900 p-4 sm:p-8 font-sans">
      <style>{`
        .loading-spinner {
          border-top-color: #f3f3f3;
          border-left-color: #f3f3f3;
          border-right-color: #ca8a04;
          border-bottom-color: #ca8a04;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* User Info / Debug Header (Required for multi-user apps) */}
      {isAuthReady && userId && (
        <div className="text-xs text-gray-500 mb-4 truncate">
          App ID: {appId} | User ID: {userId}
        </div>
      )}

      <div className="max-w-4xl mx-auto">
        <header className="text-center mb-10">
          <h1 className="text-4xl font-extrabold text-yellow-400 drop-shadow-lg">
            D&D Battle Master AI
          </h1>
          <p className="mt-2 text-gray-400">
            Generate balanced D&D 5e/2024 combat encounters based on your party's power.
          </p>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* --- Input Panel --- */}
          <div className="lg:col-span-1 p-6 bg-gray-800 rounded-xl shadow-2xl h-fit border-2 border-gray-700">
            <h2 className="text-2xl font-semibold mb-6 text-white border-b border-yellow-700/50 pb-2">
              Party Details
            </h2>
            <form onSubmit={generateEncounter} className="space-y-4">
              
              {/* Party Size */}
              <div>
                <label htmlFor="partySize" className="block text-sm font-medium text-gray-300 mb-1">
                  Number of Players
                </label>
                <input
                  id="partySize"
                  type="number"
                  min="1"
                  max="12"
                  value={partySize}
                  onChange={(e) => setPartySize(Math.max(1, Math.min(12, parseInt(e.target.value) || 1)))}
                  className="w-full p-3 bg-gray-700 text-white border border-gray-600 rounded-lg focus:ring-yellow-500 focus:border-yellow-500 transition duration-150"
                  required
                />
              </div>

              {/* Average Level */}
              <div>
                <label htmlFor="averageLevel" className="block text-sm font-medium text-gray-300 mb-1">
                  Average Party Level
                </label>
                <input
                  id="averageLevel"
                  type="number"
                  min="1"
                  max="20"
                  value={averageLevel}
                  onChange={(e) => setAverageLevel(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  className="w-full p-3 bg-gray-700 text-white border border-gray-600 rounded-lg focus:ring-yellow-500 focus:border-yellow-500 transition duration-150"
                  required
                />
              </div>

              {/* Desired Number of Enemies (NEW FIELD) */}
              <div>
                <label htmlFor="numEnemies" className="block text-sm font-medium text-gray-300 mb-1">
                  Desired Number of Enemies (Total)
                </label>
                <input
                  id="numEnemies"
                  type="number"
                  min="1"
                  max="20"
                  value={numEnemies}
                  onChange={(e) => setNumEnemies(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                  className="w-full p-3 bg-gray-700 text-white border border-gray-600 rounded-lg focus:ring-yellow-500 focus:border-yellow-500 transition duration-150"
                  required
                />
              </div>

              {/* Difficulty */}
              <div>
                <label htmlFor="difficulty" className="block text-sm font-medium text-gray-300 mb-1">
                  Desired Difficulty (5e Standard)
                </label>
                <select
                  id="difficulty"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  className="w-full p-3 bg-gray-700 text-white border border-gray-600 rounded-lg focus:ring-yellow-500 focus:border-yellow-500 appearance-none transition duration-150"
                  required
                >
                  <option value="Easy">Easy (Minimal threat)</option>
                  <option value="Medium">Medium (Resource drain)</option>
                  <option value="Hard">Hard (Significant danger)</option>
                  <option value="Deadly">Deadly (Potential TPK)</option>
                </select>
              </div>
              
              {/* Terrain/Setting */}
              <div>
                <label htmlFor="terrain" className="block text-sm font-medium text-gray-300 mb-1">
                  Encounter Setting / Terrain
                </label>
                <input
                  id="terrain"
                  type="text"
                  value={terrain}
                  onChange={(e) => setTerrain(e.target.value)}
                  placeholder="e.g., Mountain Pass, Sewer Labyrinth"
                  className="w-full p-3 bg-gray-700 text-white border border-gray-600 rounded-lg focus:ring-yellow-500 focus:border-yellow-500 transition duration-150"
                  required
                />
              </div>

              {/* Flavor/Context */}
              <div>
                <label htmlFor="flavor" className="block text-sm font-medium text-gray-300 mb-1">
                  Context / Narrative Hook
                </label>
                <input
                  id="flavor"
                  type="text"
                  value={flavor}
                  onChange={(e) => setFlavor(e.target.value)}
                  placeholder="e.g., They are interrupting a ritual, guarding a chest"
                  className="w-full p-3 bg-gray-700 text-white border border-gray-600 rounded-lg focus:ring-yellow-500 focus:border-yellow-500 transition duration-150"
                  required
                />
              </div>

              {/* Generate Button */}
              <button
                type="submit"
                disabled={isLoading}
                className={`w-full flex items-center justify-center py-3 px-4 rounded-lg font-bold text-gray-900 transition duration-300 shadow-md ${
                  isLoading
                    ? 'bg-yellow-800 cursor-not-allowed'
                    : 'bg-yellow-400 hover:bg-yellow-500 active:bg-yellow-600'
                }`}
              >
                {isLoading ? (
                  <div className="flex items-center">
                    <div className="loading-spinner w-5 h-5 border-4 rounded-full mr-2"></div>
                    Generating Encounter...
                  </div>
                ) : (
                  'Generate Combat Encounter'
                )}
              </button>
            </form>
          </div>

          {/* --- Output Panel --- */}
          <div className="lg:col-span-2 p-6 bg-gray-800 rounded-xl shadow-2xl border-2 border-gray-700 min-h-[400px]">
            <h2 className="text-2xl font-semibold mb-6 text-white border-b border-yellow-700/50 pb-2">
              Generated Encounter
            </h2>

            {error && (
              <div className="p-4 bg-red-900/50 border border-red-700 rounded-lg text-red-300 mb-4">
                <p className="font-semibold">Generation Error:</p>
                <p>{error}</p>
                <p className='mt-2 text-sm'>Please check your inputs and try again.</p>
              </div>
            )}

            {encounterOutput ? (
              <>
                <div className="text-gray-200 space-y-4">
                  <RenderMarkdown content={encounterOutput} />
                </div>
                
                {sources.length > 0 && (
                  <div className="mt-8 pt-4 border-t border-gray-700">
                    <h3 className="text-sm font-semibold text-gray-500 mb-2">Sources Used for Rules/Monsters:</h3>
                    <ul className="list-disc list-inside text-xs text-gray-500 space-y-1">
                      {sources.map((source, index) => (
                        <li key={index} className="truncate">
                          <a 
                            href={source.uri} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="hover:text-yellow-400 transition-colors duration-150"
                          >
                            {source.title || source.uri}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              !isLoading && (
                <div className="text-center p-12 text-gray-500">
                  <svg className="w-10 h-10 mx-auto mb-3 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c1.657 0 3 .895 3 2s-1.343 2-3 2-3 .895-3 2-1.343 2-3 2V8z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                  <p>Input your party details to generate a custom, balanced D&D encounter.</p>
                </div>
              )
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default App;
