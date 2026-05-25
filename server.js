import express from 'express';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

app.post('/api/chat', async (req, res) => {
try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
    },
    body: JSON.stringify({
        model: req.body.model,
        max_tokens: req.body.max_tokens,
        system: req.body.system,
        messages: req.body.messages
    })
    });
    const data = await response.json();
    res.json(data);
} catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
}
});

app.post('/api/run', async (req, res) => {
try {
    const { code, language_id } = req.body;
    const response = await fetch('https://judge0-ce.p.rapidapi.com/submissions?base64_encoded=false&wait=true', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'judge0-ce.p.rapidapi.com'
    },
    body: JSON.stringify({
        source_code: code,
        language_id: language_id,
        stdin: ''
    })
    });
    const data = await response.json();
    res.json(data);
} catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
}
});

app.use(express.static('.'));

app.listen(3000, () => {
console.log('Servidor iniciado en http://localhost:3000');
});