const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const axios = require('axios');
const cheerio = require('cheerio');
const stopwords = new Set(require('./stopwords-en.json'));

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const gameSessions = new Map();
const clients = new Map();

const COLORS = [
  '#d32f2f', '#1976d2', '#388e3c', '#f57c00',
  '#7b1fa2', '#c2185b', '#00796b', '#5d4037'
];

function generateId(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function buildRedactedArticle(session) {
  return session.originalWords.map(word => {
    const lower = word.toLowerCase();
    if (/\w+/.test(word) && !stopwords.has(lower)) {
      return session.guessedWords.has(lower) ? word : '█'.repeat(word.length);
    }
    return word;
  }).join('');
}

async function fetchRandomWikipediaArticle() {
  try {
    const summaryRes = await axios.get('https://en.wikipedia.org/api/rest_v1/page/random/summary');
    const title = summaryRes.data.title;

    const parseRes = await axios.get(
      `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&format=json&prop=text&formatversion=2&origin=*`
    );

    const html = parseRes.data.parse.text;
    const $ = cheerio.load(html);

    let resultParagraphs = [];

    // Grab first 1–2 intro paragraphs
    const introParagraphs = $('p').filter((i, el) => $(el).text().trim().length > 50).slice(0, 2);
    introParagraphs.each((i, el) => resultParagraphs.push($(el).text().trim()));

    // Section-based content
    $('h2').each((i, h2) => {
      const sectionTitle = $(h2).text().replace(/\[edit\]/g, '').trim();
      if (['References', 'External links', 'See also', 'Notes', 'Sources'].includes(sectionTitle)) return;

      const nextElems = $(h2).nextAll();
      let sectionParas = [];

      nextElems.each((j, el) => {
        if (el.tagName === 'h2') return false;
        if (el.tagName === 'p') {
          const txt = $(el).text().trim();
          if (txt.length > 50) sectionParas.push(txt);
        }
      });

      if (sectionParas.length > 0) {
        resultParagraphs.push(`\n\n${sectionTitle}\n`);
        resultParagraphs.push(...sectionParas.slice(0, 2));
      }
    });

    const cleaned = resultParagraphs.join('\n\n');
    const articleText = `${title}. ${cleaned}`;
    const words = articleText.split(/(\W+)/);

    return { title, text: articleText, words };
  } catch (err) {
    console.error('⚠️ Failed to load full article, using fallback:', err.message);
    const fallback = 'Internet. The Internet is a global system of interconnected networks...';
    return {
      title: 'Internet',
      text: fallback,
      words: fallback.split(/(\W+)/)
    };
  }
}

wss.on('connection', (ws) => {
  ws.on('message', async (data) => {
    const msg = JSON.parse(data);

    if (msg.type === 'join_game') {
      const gameId = msg.gameId || generateId();
      let session = gameSessions.get(gameId);

      if (!session) {
        const { title, text, words } = await fetchRandomWikipediaArticle();
        session = {
          articleTitle: title,
          articleText: text,
          originalWords: words,
          guessedWords: new Set(),
          gameEnded: false,
          guessHistory: [],
          playerColors: []
        };
        gameSessions.set(gameId, session);
        console.log(`🆕 Game "${gameId}" loaded article: "${title}"`);
      }

      const color = COLORS[session.playerColors.length % COLORS.length];
      session.playerColors.push(color);
      clients.set(ws, { gameId, name: msg.name, color });

      const redacted = session.gameEnded ? session.articleText : buildRedactedArticle(session);
      ws.send(JSON.stringify({
        type: 'article_init',
        text: redacted,
        title: session.articleTitle,
        guesses: session.guessHistory
      }));
    }

    if (msg.type === 'submit_guess') {
      const client = clients.get(ws);
      const session = gameSessions.get(client.gameId);
      if (!session || session.gameEnded) return;

      const word = msg.word.toLowerCase();
      if (!session.guessedWords.has(word)) {
        session.guessedWords.add(word);

        session.guessHistory.push({
          word,
          name: client.name,
          color: client.color,
          correct: session.originalWords.map(w => w.toLowerCase()).includes(word)
        });

        const normalizedTitle = session.articleTitle
          .replace(/\(.*?\)/g, '') // remove (content)
          .replace(/[^\w\s]/g, '') // remove punctuation
          .toLowerCase();

        const titleWords = normalizedTitle.split(/\s+/).filter(Boolean);
        const allTitleWordsGuessed = titleWords.every(w => session.guessedWords.has(w));

        if (allTitleWordsGuessed) {
          session.gameEnded = true;
          broadcast(client.gameId, {
            type: 'game_over',
            text: session.articleText,
            winner: session.articleTitle
          });
          return;
        }

        broadcast(client.gameId, {
          type: 'article_update',
          text: buildRedactedArticle(session),
          guesses: session.guessHistory
        });
      }
    }

    if (msg.type === 'give_up') {
      const client = clients.get(ws);
      const session = gameSessions.get(client.gameId);
      if (!session || session.gameEnded) return;

      session.gameEnded = true;
      broadcast(client.gameId, {
        type: 'game_over',
        text: session.articleText,
        winner: null
      });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
  });
});

function broadcast(gameId, message) {
  const payload = JSON.stringify(message);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && clients.get(client)?.gameId === gameId) {
      client.send(payload);
    }
  });
}

server.listen(3001, () => console.log('✅ Server running on http://localhost:3001'));
