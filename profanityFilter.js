// profanityFilter.js
const fs = require('fs');
const path = require('path');

const community_TROLL_MESSAGE = "Shut up you simpleton you're a goober";

const LEET_MAP = {
    '@': 'a', '4': 'a',
    '8': 'b',
    '(': 'c', '<': 'c',
    '3': 'e',
    '1': 'i', '!': 'i', '|': 'i',
    '0': 'o',
    '5': 's', '$': 's',
    '7': 't', '+': 't',
    'v': 'u'
};

const SAFE_WHITELIST = new Set([
    "grass", "glass", "sea", "bass", "class", "compass", "pass", "dirt",
    "wood", "stone", "block", "craft", "mine", "pickaxe", "sword", "shovel",
    "axe", "bread", "chest", "furnace", "torch", "piston", "anvil",
    "bed", "bow", "arrow", "boat", "bucket", "clock", "mass", "brass"
]);

const BANNED_WORDS_SET = new Set();
let BANNED_WORDS_ARRAY = [];

// Dedicated explicit regex patterns that CANNOT be bypassed by single/double letters or leet symbols
const HARDCODED_SLUR_REGEX = [
    /n+[i1!|]+[g9]+[a@4eErR]+/i,      // Catches niga, nigga, nigg@, nig@, n1gga, n1gg@, nigger
    /f+[a@4]+[g9]+(o+[t7+]|e+[t7+]|[t7+])*/i, // Catches fag, fagg, faggot, f@g
    /b+[i1!|]+[t7+]+c+h+/i,           // Catches bitch, biitch, b!tch, b1tch
    /s+h+[i1!|]+[t7+]+/i,             // Catches shit, sh1t, sh!t
    /f+u+c+k+/i                       // Catches fuck, fuuuck, fukk
];

function loadProfanityDatabase() {
    try {
        const filePath = path.join(__dirname, 'profanity_list.txt');
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            const lines = raw.split(/\r?\n/);
            lines.forEach(line => {
                const clean = line.trim().toLowerCase();
                if (clean && clean.length >= 2 && !SAFE_WHITELIST.has(clean) && clean !== "hoe") {
                    BANNED_WORDS_SET.add(clean);
                }
            });
            console.log(`🛡️ Loaded ${BANNED_WORDS_SET.size} prohibited terms into moderation memory.`);
        } else {
            console.warn("⚠️ Warning: profanity_list.txt not found. Using fallback banned list.");
            const fallback = ["bitch", "shit", "fuck", "cunt", "nigger", "nigga", "asshole", "bastard"];
            fallback.forEach(w => BANNED_WORDS_SET.add(w));
        }

        // Stems and collapsed variants
        BANNED_WORDS_SET.add("nigg");
        BANNED_WORDS_SET.add("nig");
        BANNED_WORDS_SET.add("niga");
        BANNED_WORDS_SET.add("nigga");
        BANNED_WORDS_SET.add("nigger");
        BANNED_WORDS_SET.add("fag");
        BANNED_WORDS_SET.add("fagg");

        BANNED_WORDS_ARRAY = Array.from(BANNED_WORDS_SET);
    } catch (err) {
        console.error("🔴 Error loading profanity_list.txt:", err);
    }
}

loadProfanityDatabase();

function normalizeString(raw) {
    if (!raw || typeof raw !== 'string') return { original: "", mapped: "", squashed: "", stripped: "" };
    const original = raw.toLowerCase().trim();

    let mapped = "";
    for (let i = 0; i < original.length; i++) {
        const ch = original[i];
        mapped += LEET_MAP[ch] || ch;
    }

    const squashed = mapped.replace(/(.)\1+/g, '$1');
    const stripped = squashed.replace(/[^a-z]/g, '');

    return { original, mapped, squashed, stripped };
}

function isProfane(text, isUsername = false) {
    if (!text || typeof text !== 'string') return false;

    const cleanInput = text.toLowerCase().trim();
    if (cleanInput.length < 2) return false;

    // "hoe" allowed in chat, blocked as username
    if (!isUsername && cleanInput === "hoe") {
        return false;
    }
    if (isUsername && cleanInput.includes("hoe")) {
        return true;
    }

    if (SAFE_WHITELIST.has(cleanInput)) {
        return false;
    }

    // 1. Direct Regex Slur Test (Instant, no bypass possible)
    for (let i = 0; i < HARDCODED_SLUR_REGEX.length; i++) {
        if (HARDCODED_SLUR_REGEX[i].test(cleanInput) || HARDCODED_SLUR_REGEX[i].test(text)) {
            return true;
        }
    }

    const { original, mapped, squashed, stripped } = normalizeString(text);

    // 2. Set Matching
    if (BANNED_WORDS_SET.has(original) || BANNED_WORDS_SET.has(mapped) || BANNED_WORDS_SET.has(squashed) || BANNED_WORDS_SET.has(stripped)) {
        return true;
    }

    // 3. Token Splitting
    const tokens = mapped.split(/[\s\-_.,;:/\\!#$%^&*()+=~`]+/);
    for (const token of tokens) {
        if (token.length >= 2 && !SAFE_WHITELIST.has(token)) {
            const tokenSquashed = token.replace(/(.)\1+/g, '$1');
            if (BANNED_WORDS_SET.has(token) || BANNED_WORDS_SET.has(tokenSquashed)) {
                return true;
            }
            for (let i = 0; i < HARDCODED_SLUR_REGEX.length; i++) {
                if (HARDCODED_SLUR_REGEX[i].test(token) || HARDCODED_SLUR_REGEX[i].test(tokenSquashed)) {
                    return true;
                }
            }
        }
    }

    // 4. Substring embed check for usernames
    if (isUsername) {
        for (let i = 0; i < BANNED_WORDS_ARRAY.length; i++) {
            const badWord = BANNED_WORDS_ARRAY[i];
            if (badWord.length >= 4 && stripped.includes(badWord)) {
                return true;
            }
        }
    }

    return false;
}

module.exports = {
    isProfane,
    community_TROLL_MESSAGE
};