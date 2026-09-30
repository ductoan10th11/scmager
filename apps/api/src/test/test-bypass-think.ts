import axios from 'axios';

const BASE_URL = 'http://100.94.148.68:8000/v1';
const API_KEY = 'expsolution_e112233';
const MODEL = 'qwen3.8-27b';

async function test1() {
  console.log('--- TEST 1: Assistant Prefill with </think> ---');
  try {
    const t0 = Date.now();
    const res = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: 'You are an AI assistant. Output JSON directly.' },
          { role: 'user', content: 'Thu ngân sách 7151/3893 triệu đồng. Trích xuất JSON.' },
          { role: 'assistant', content: '</think>\n```json\n[' },
        ],
        max_tokens: 300,
        temperature: 0.1,
      },
      {
        headers: { Authorization: `Bearer ${API_KEY}` },
        timeout: 15000,
      }
    );
    console.log('Latency:', Date.now() - t0, 'ms');
    console.log('Response:\n', res.data.choices[0].message.content);
  } catch (err: any) {
    console.log('Test 1 error:', err.response?.data || err.message);
  }
}

async function test2() {
  console.log('\n--- TEST 2: enable_thinking: false or chat_template_kwargs ---');
  try {
    const t0 = Date.now();
    const res = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: 'You are an AI assistant. Output JSON directly.' },
          { role: 'user', content: 'Thu ngân sách 7151/3893 triệu đồng. Trích xuất JSON.' },
        ],
        chat_template_kwargs: { enable_thinking: false },
        max_tokens: 300,
        temperature: 0.1,
      },
      {
        headers: { Authorization: `Bearer ${API_KEY}` },
        timeout: 15000,
      }
    );
    console.log('Latency:', Date.now() - t0, 'ms');
    console.log('Response:\n', res.data.choices[0].message.content);
  } catch (err: any) {
    console.log('Test 2 error:', err.response?.data || err.message);
  }
}

async function test3() {
  console.log('\n--- TEST 3: stop: ["</think>"] or max_thinking_tokens ---');
  try {
    const t0 = Date.now();
    const res = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: 'You are an AI assistant. Output JSON directly.' },
          { role: 'user', content: 'Thu ngân sách 7151/3893 triệu đồng. Trích xuất JSON.' },
        ],
        extra_body: {
          thinking: { type: 'disabled' },
        },
        max_tokens: 300,
        temperature: 0.1,
      },
      {
        headers: { Authorization: `Bearer ${API_KEY}` },
        timeout: 15000,
      }
    );
    console.log('Latency:', Date.now() - t0, 'ms');
    console.log('Response:\n', res.data.choices[0].message.content);
  } catch (err: any) {
    console.log('Test 3 error:', err.response?.data || err.message);
  }
}

async function run() {
  await test1();
  await test2();
  await test3();
}

run();
