# Pokémon TCG Deck Builder

A full-stack web app to track your Pokémon TCG collection and auto-build decks.

## Features
- MySQL schema for expansions, cards, inventory, decks
- Node.js/Express API
- Static frontend
- Render deployment config

## Setup
1. Clone repo
2. Create `.env` from `.env.example`
3. Run `npm install` in `api/`
4. Start API: `npm start`
5. Open `public/index.html` in browser

## Deploy to Render
- Push this repo to GitHub
- Connect repo in Render dashboard
- Render will provision:
  - MySQL database
  - API service
  - Static site
