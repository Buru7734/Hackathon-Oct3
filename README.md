# Hackathon-Oct3

# D&D Battle Master AI

**D&D Battle Master AI** is a React-based web application that generates balanced Dungeons & Dragons 5e combat encounters tailored to your party's level, size, and preferred difficulty. The app leverages Google’s Gemini AI API for content generation and integrates Firebase for user management.

---

## Table of Contents

- [Demo](#demo)
- [Features](#features)
- [Technologies](#technologies)
- [Installation](#installation)
- [Usage](#usage)
- [Configuration](#configuration)
- [Firebase Integration](#firebase-integration)
- [Contributing](#contributing)
- [License](#license)

## Features

- Generate D&D 5e encounters based on:
  - Party size
  - Average character level
  - Desired difficulty (Easy, Medium, Hard, Deadly)
  - Terrain/setting
  - Flavor/narrative hooks
- Clean, Markdown-based encounter output
- Displays structured monster stats (AC, HP, speed, attacks)
- Source attribution for rules/monsters (when available)
- Firebase Authentication (anonymous or custom token)
- Exponential backoff for AI API requests
- Fully responsive design with Tailwind CSS

---

## Technologies

- **Frontend:** React, Tailwind CSS
- **Backend Services:** Firebase Authentication & Firestore (optional)
- **AI Integration:** Google Gemini API (`generativelanguage.googleapis.com`)
- **Others:** Vanilla JS for Markdown rendering, Fetch API for requests

---

## Installation

1. Clone the repository:

```bash
git clone https://github.com/your-username/dnd-battle-master-ai.git
cd dnd-battle-master-ai
```

## Contributors

Sara Mattina

Daequan Sessíon
