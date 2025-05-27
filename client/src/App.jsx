import React, { useState, useEffect } from 'react';
import stopwordsList from './data/stopwords-en.json';

const stopwords = new Set(stopwordsList.map(w => w.toLowerCase()));

function getGameIdFromUrl() {
  const parts = window.location.pathname.split('/');
  return parts.includes('game') ? parts.pop() : null;
}

function generateGameId(length = 6) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function App() {
  let gameId = getGameIdFromUrl();
  if (!gameId) {
    gameId = generateGameId();
    window.history.replaceState(null, '', `/game/${gameId}`);
  }

  const [ws, setWs] = useState(null);
  const [name, setName] = useState('');
  const [input, setInput] = useState('');
  const [article, setArticle] = useState('');
  const [articleTitle, setArticleTitle] = useState('');
  const [guesses, setGuesses] = useState([]);
  const [gameOver, setGameOver] = useState(false);
  const [wasGuessed, setWasGuessed] = useState(false);
  const [revealedWordIndices, setRevealedWordIndices] = useState(new Set());

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:3001');

    socket.onopen = () => {
      setWs(socket);
      socket.send(JSON.stringify({ type: 'join_game', gameId, name }));
    };

    socket.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.type === 'article_init') {
        setArticle(data.text);
        if (data.guesses) setGuesses(data.guesses);
        if (data.title) setArticleTitle(data.title);
      }
      if (data.type === 'article_update') {
        setArticle(data.text);
        if (data.guesses) setGuesses(data.guesses);
      }
      if (data.type === 'game_over') {
        setArticle(data.text);
        setGameOver(true);
        setWasGuessed(!!data.winner);
      }
    };

    return () => socket.close();
  }, [gameId, name]);

  const sendGuess = () => {
    const word = input.trim().toLowerCase();
    if (ws && word) {
      ws.send(JSON.stringify({ type: 'submit_guess', word }));
      setInput('');
    }
  };

  const giveUp = () => {
    if (ws && !gameOver) {
      ws.send(JSON.stringify({ type: 'give_up' }));
    }
  };

  const renderRedactedText = (text, type) => {
    return text.split(/\s+/).map((word, i) => {
      const cleaned = word.toLowerCase().replace(/[^a-z0-9]/g, '');
      const isGuessed = guesses.some(g => g.correct && g.word.toLowerCase() === cleaned);
      const isStopword = stopwords.has(cleaned);
      const isRevealed = revealedWordIndices.has(`${type}-${i}`);

      if (isGuessed || isStopword || gameOver) {
        return (
          <span key={`${type}-${i}`} style={{ marginRight: '4px' }}>
            {word}
          </span>
        );
      }

      return (
        <span
          key={`${type}-${i}`}
          style={{
            display: 'inline-block',
            backgroundColor: 'black',
            width: `${word.length * 0.6}ch`,
            height: '1em',
            marginRight: '4px',
            color: isRevealed ? 'white' : 'black',
            textAlign: 'center',
            cursor: 'pointer',
            lineHeight: '1em'
          }}
          onClick={() => {
            setRevealedWordIndices(prev => new Set(prev).add(`${type}-${i}`));
          }}
        >
          {isRevealed ? `(${word.length})` : ''}
        </span>
      );
    });
  };

  if (!name) {
    return (
      <div style={{ padding: '2rem' }}>
        <h2>Enter your name to join game <code>{gameId}</code></h2>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const entered = input.trim();
              if (entered) {
                setName(entered);
                setInput('');
              }
            }
          }}
        />
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'Arial, sans-serif' }}>
      <h1>LetsGuess Multiplayer</h1>

      {gameOver && (
        <div style={{
          padding: '1rem',
          backgroundColor: wasGuessed ? '#e0ffe0' : '#d0f0ff',
          border: '1px solid #4caf50',
          marginBottom: '1rem'
        }}>
          <strong>
            🎉 {wasGuessed ? 'The article was correctly guessed!' : 'Article revealed — game over.'}
          </strong>
        </div>
      )}

      <h2 style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>
        {renderRedactedText(articleTitle, 'title')}
      </h2>

      <p>
        Welcome, <strong>{name}</strong><br />
        You are in game: <code>{gameId}</code><br />
        <button
          onClick={() => {
            const newGameId = generateGameId();
            window.location.href = `/game/${newGameId}`;
          }}
          style={{ marginRight: '1rem' }}
        >
          🔄 New Game
        </button>
        <button
          onClick={() => {
            const url = `${window.location.origin}/game/${gameId}`;
            navigator.clipboard.writeText(url);
            alert('🔗 Game link copied to clipboard!');
          }}
        >
          📋 Copy Link
        </button>
      </p>

      <pre
        style={{
          whiteSpace: 'pre-wrap',
          border: '1px solid #ccc',
          padding: '1rem',
          minHeight: '150px',
          backgroundColor: '#f9f9f9'
        }}
      >
        {renderRedactedText(article, 'body')}
      </pre>

      {!gameOver && (
        <div style={{ marginTop: '1rem' }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendGuess()}
            placeholder="Enter your guess"
            style={{ marginRight: '0.5rem', padding: '0.5rem', fontSize: '1rem' }}
          />
          <button onClick={sendGuess} style={{ padding: '0.5rem 1rem', fontSize: '1rem' }}>
            Guess
          </button>
          <button onClick={giveUp} style={{ padding: '0.5rem 1rem', fontSize: '1rem', marginLeft: '0.5rem' }}>
            Give Up
          </button>
        </div>
      )}

      <div style={{ marginTop: '2rem' }}>
        <h3>Guesses</h3>
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {guesses.map((g, i) => (
            <li key={i}>
              <span style={{ fontWeight: 'bold', color: g.color }}>{g.name}</span>: <span style={{ fontWeight: g.correct ? 'bold' : 'normal' }}>{g.word}</span>
            </li>
          ))}
        </ul>
        <p>Total guesses: <strong>{guesses.length}</strong></p>
      </div>
    </div>
  );
}

export default App;
