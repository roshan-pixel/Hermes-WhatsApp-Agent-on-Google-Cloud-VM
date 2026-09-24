const fs = require('fs');
const path = require('path');

let memoryGraph = null;
const graphPath = path.join(__dirname, 'chat-memory-graph', 'graph.json');

try {
    if (fs.existsSync(graphPath)) {
        memoryGraph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
        console.log(`[MemoryGraph] Loaded ${memoryGraph.nodes.length} nodes & ${(memoryGraph.links || []).length} edges for Himanshi & Roshan`);
    }
} catch (e) {
    console.error('[MemoryGraph] Error loading graph:', e.message);
}

/**
 * Searches the Graphify knowledge graph for relevant past memories,
 * shared events, inside jokes, and milestones between Roshan and Himanshi.
 */
function queryChatMemory(userQuery) {
    if (!memoryGraph || !memoryGraph.nodes || !userQuery) return '';
    const qLower = userQuery.toLowerCase();

    // Past memory triggers
    const memoryKeywords = [
        'yaad', 'pehla', 'pehle', 'before', 'past', 'purani', 'ssb', 'curfew', 
        '6 bje', '6 baje', 'sms', 'hospital', 'braces', 'scooty', 'white shirt', 
        'coffee', 'mumma', 'mummy', 'papa', 'papaji', 'hardik', 'ravi', 'shruti', 
        'enterprises', 'youtube', 'video', 'exam', 'crying', 'ro rahi', 'overthink', 
        'guilt', 'hug', 'shaadi', 'marriage', 'doodh', 'lallu', 'chote don', 'canteen',
        'kya hua tha', 'kab hua tha', 'uss din', 'interview', 'ex'
    ];

    const hasTrigger = memoryKeywords.some(kw => qLower.includes(kw));
    if (!hasTrigger) return '';

    const words = qLower.split(/[\s,?.!]+/).filter(w => w.length > 2);
    const matched = [];

    for (const node of memoryGraph.nodes) {
        const label = (node.label || '').toLowerCase();
        const rationale = (node.rationale || '').toLowerCase();
        let score = 0;
        for (const w of words) {
            if (label.includes(w)) score += 3;
            if (rationale.includes(w)) score += 1;
        }
        if (score > 1) {
            matched.push({ node, score });
        }
    }

    matched.sort((a, b) => b.score - a.score);
    const top = matched.slice(0, 3);
    if (top.length === 0) return '';

    return `\n[RECALLED PAST MEMORY FROM GRAPHIFY (Your actual past memories together - reference naturally if relevant)]:\n` +
        top.map(m => `- ${m.node.label}: ${m.node.rationale || ''}`).join('\n') + '\n';
}

module.exports = { queryChatMemory };
