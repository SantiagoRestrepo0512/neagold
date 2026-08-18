import http from 'node:http'
import request from 'supertest'

const handler = (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ ok: true, path: req.url }))
}

async function run(prelistened) {
  const server = http.createServer(handler)
  if (prelistened) await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const results = Array.from({ length: 3 }, async (_, i) => {
    const agent = request.agent(server)
    const a = await agent.get('/csrf')
    const b = await agent.get('/csrf')
    return { i, a: a.status, b: b.status }
  })
  try {
    await Promise.all(results)
  } finally {
    server.close()
  }
}

for (const prelistened of [false, true]) {
  let failures = 0
  const runs = 20
  for (let i = 0; i < runs; i++) {
    try {
      await run(prelistened)
    } catch (e) {
      failures++
    }
  }
  console.log(`prelistened=${prelistened}: ${failures}/${runs} corridas fallaron`)
}
process.exit(0)