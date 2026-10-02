// config.js
const path = require('path');
const fs = require('fs');

const COOKIE_SECRET = 'REPLACE_WITH_COOKIE_SECRET';

// 🟢 Centrally Configured Mode Player Caps & Round Counts
const MODE_LIMITS = {
    0: 6,   // Mode 0 (Classic Mrivia): 6 players
    1: 6,   // Mode 1 (Pixelary):       6 players
    2: 4,   // Mode 2 (Recipe):         4 players
    3: 4,   // Mode 3 (Minele):         4 players
    4: 2    // Mode 4 (SZC):            2 players
};

const ROUND_LIMITS = {
    0: 12,  // Mode 0: 12 rounds
    1: 6,   // Mode 1: 6 rounds
    2: 8,   // Mode 2: 8 rounds
    3: 4,   // Mode 3: 4 rounds
    4: 5    // Mode 4 (SZC):            5 rounds
};

const userCache = {};
const activeRooms = {};
const deletionTimeouts = {};

// Default Fallbacks for File Missing Scenarios
const defaultPixelaryPool = [
    "STEVE", "ALEX", "ZOMBIE", "SKELETON", "ENDERMAN",
    "PIG", "COW", "SHEEP", "CREEPER", "DIAMOND PICKAXE",
    "NETHER PORTAL", "CRAFTING TABLE"
];

let masterPixelaryData = {};
let masterTriviaData = {};
let masterMineleData = {};
let masterRecipeData = {};

function loadPixelaryData() {
    try {
        const jsonPath = path.join(__dirname, 'pixelary_data.json');
        // Clear in-place to preserve memory references across all files
        Object.keys(masterPixelaryData).forEach(k => delete masterPixelaryData[k]);

        if (fs.existsSync(jsonPath)) {
            const rawData = fs.readFileSync(jsonPath, 'utf8');
            const parsed = JSON.parse(rawData);

            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                Object.keys(parsed).forEach(category => {
                    masterPixelaryData[category] = [];
                    const items = parsed[category];
                    if (Array.isArray(items)) {
                        items.forEach(item => {
                            if (item) {
                                let val = "";
                                if (typeof item === 'string') {
                                    val = item.trim().toUpperCase();
                                } else if (typeof item === 'object') {
                                    const possibleVal = item.word || item.name;
                                    if (possibleVal) val = String(possibleVal).trim().toUpperCase();
                                }
                                if (val) {
                                    masterPixelaryData[category].push(val);
                                }
                            }
                        });
                    }
                });
            } else if (Array.isArray(parsed)) {
                masterPixelaryData["General"] = [];
                parsed.forEach(item => {
                    if (item) {
                        const val = String(item).trim().toUpperCase();
                        masterPixelaryData["General"].push(val);
                    }
                });
            }
            console.log(`🟢 Loaded Pixelary target words across ${Object.keys(masterPixelaryData).length} categories.`);
        } else {
            console.log("⚠️ Warning: pixelary_data.json not found. Using fallback Pixelary pool.");
            masterPixelaryData = {
                "Mobs": ["STEVE", "ALEX", "ZOMBIE", "SKELETON", "ENDERMAN", "CREEPER"],
                "Items": ["DIAMOND PICKAXE", "NETHER PORTAL", "CRAFTING TABLE"]
            };
        }
    } catch (error) {
        console.error("🔴 Error reading pixelary_data.json:", error);
        masterPixelaryData = { "General": [...defaultPixelaryPool] };
    }
}

function loadMriviaData() {
    try {
        const jsonPath = path.join(__dirname, 'mrivia_data.json');
        // Clear in-place to preserve memory references across all files
        Object.keys(masterTriviaData).forEach(k => delete masterTriviaData[k]);

        if (fs.existsSync(jsonPath)) {
            const rawData = fs.readFileSync(jsonPath, 'utf8');
            const parsed = JSON.parse(rawData);

            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                Object.keys(parsed).forEach(category => {
                    masterTriviaData[category] = [];
                    const items = parsed[category];
                    if (Array.isArray(items)) {
                        items.forEach(item => {
                            if (item) {
                                let val = "";
                                if (typeof item === 'string') {
                                    val = item.trim().toUpperCase();
                                } else if (typeof item === 'object') {
                                    const possibleVal = item.word || item.name;
                                    if (possibleVal) val = String(possibleVal).trim().toUpperCase();
                                }
                                if (val) {
                                    masterTriviaData[category].push(val);
                                }
                            }
                        });
                    }
                });
            } else if (Array.isArray(parsed)) {
                masterTriviaData["General"] = [];
                parsed.forEach(item => {
                    if (item) {
                        const val = String(item).trim().toUpperCase();
                        masterTriviaData["General"].push(val);
                    }
                });
            }
            console.log(`🟢 Successfully loaded trivia items across ${Object.keys(masterTriviaData).length} categories.`);
        } else {
            masterTriviaData = { "General": ["DIAMOND SWORD", "CREEPER", "NETHERITE INGOT"] };
        }
    } catch (error) {
        masterTriviaData = { "General": ["DIAMOND SWORD", "CREEPER", "NETHERITE INGOT"] };
    }
}

function loadMineleData() {
    try {
        const jsonPath = path.join(__dirname, 'minele_data.json');
        // Clear in-place to preserve memory references across all files
        Object.keys(masterMineleData).forEach(k => delete masterMineleData[k]);

        if (fs.existsSync(jsonPath)) {
            const rawData = fs.readFileSync(jsonPath, 'utf8');
            const parsed = JSON.parse(rawData);
            Object.assign(masterMineleData, parsed);
            console.log("🟢 Minele Categorized Data Loaded.");
        }
    } catch (error) {
        console.error("🔴 Error loading minele_data.json:", error);
    }
}

function loadRecipeData() {
    try {
        const jsonPath = path.join(__dirname, 'recipe_data.json');
        // Clear in-place to preserve memory references across all files
        Object.keys(masterRecipeData).forEach(k => delete masterRecipeData[k]);

        if (fs.existsSync(jsonPath)) {
            const rawData = fs.readFileSync(jsonPath, 'utf8');
            const parsed = JSON.parse(rawData);
            Object.assign(masterRecipeData, parsed);
            console.log(`🟢 Recipe Data Loaded: ${Object.keys(masterRecipeData).length} items.`);
        }
    } catch (error) {
        console.error("🔴 Error reading recipe_data.json:", error);
    }
}

function generateMaskedPayload(secretWord, revealedPositions) {
    if (!secretWord) return [];
    let result = [];
    let currentWordStr = "";
    for (let i = 0; i < secretWord.length; i++) {
        if (secretWord[i] === " ") {
            result.push(currentWordStr);
            currentWordStr = "";
        } else {
            result.push((revealedPositions && revealedPositions[i]) ? secretWord[i] : "_");
        }
    }
    result.push(currentWordStr);
    return result;
}

// Initial loads
loadMriviaData();
loadPixelaryData();
loadMineleData();
loadRecipeData();

module.exports = {
    COOKIE_SECRET,
    MODE_LIMITS,
    ROUND_LIMITS,
    userCache,
    activeRooms,
    deletionTimeouts,
    masterPixelaryData,
    masterTriviaData,
    masterMineleData,
    masterRecipeData,
    loadMriviaData,
    loadPixelaryData,
    loadRecipeData,
    loadMineleData,
    generateMaskedPayload
};