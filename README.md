# ThreeJS Game

A simple web-based game using ThreeJS.

## Running the Project

You have several options to run the project locally:

### Option 1: Python Server (Simplest)

1. Make sure you have Python installed
2. Double-click the `start_server.bat` file
   - Or open a terminal and run: `python -m http.server 8000`
3. Open your browser and visit: `http://localhost:8000`

### Option 2: Node.js Server

1. Make sure you have Node.js installed
2. Open a terminal in the project directory
3. Run: `npm install` (first time only)
4. Run: `npm start`
5. The browser should open automatically to the game

### Option 3: VS Code Live Server

If you're using Visual Studio Code:
1. Install the "Live Server" extension
2. Right-click on `index.html`
3. Select "Open with Live Server"

## Project Structure

- `index.html` - Landing page
- `game.html` - Game page with ThreeJS setup
- `styles/` - CSS files for styling
- `js/` - JavaScript files including game logic 