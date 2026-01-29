// import { Ollama } from 'ollama';
import { createOllama } from 'ai-sdk-ollama'
import { generateText } from 'ai'

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

const res = await generateText({
  model,
  prompt: "你是谁",
});

console.log(res.text);
console.log(res.reasoningText);

// const ollama2 = new Ollama({
//   host: 'https://ollama.kkdashu.fun/',
//   headers: {
//     'CF-Access-Client-Id': CF_ACCESS_CLIENT_ID,
//     'CF-Access-Client-Secret': CF_ACCESS_CLIENT_SECRET
//   }
// });
// 
// const res2 = await ollama2.chat({
//   model: 'qwen3:14b',
//   messages: [{
//     role: 'user',
//     content: '你是谁'
//   }],
//   stream: false
// });
// console.log(res2, res2.message);
