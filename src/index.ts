// import { Ollama } from 'ollama';
import { createOllama } from 'ai-sdk-ollama'
import { streamText } from 'ai'

const CF_ACCESS_CLIENT_ID = process.env['CF-Access-Client-Id']
const CF_ACCESS_CLIENT_SECRET = process.env['CF-Access-Client-Secret']

const ollama = createOllama({
  baseURL: 'https://ollama.kkdashu.fun/',
  headers: {
    'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
    'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET
  }
});
const model = ollama(
  'qwen3:14b',
  { think: true }
);

const res = streamText({
  model,
  prompt: "你是谁",
});

for await (const chunk of res.textStream) {
  process.stdout.write(chunk);
}

process.stdout.write('\n');

console.log('reasoningText: ', await res.reasoningText);
