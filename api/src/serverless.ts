import 'reflect-metadata'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import express from 'express'
import { NestExpressApplication } from '@nestjs/platform-express'
import { createApp } from './app.factory'

/**
 * Entry serverless para Vercel (compilado a `dist/serverless.js` por `nest build`).
 *
 * El handler reutiliza la instancia de Express entre invocaciones (warm start)
 * y la inicializa solo en el primer request de cada cold start. La app Nest
 * completa se monta sobre ese server: mismo middleware, pipes y controladores
 * que en main.ts, pero sin `listen()`.
 *
 * OJO: este archivo NO debe importarse desde `src` en el bundle de Vercel.
 * El entry de Vercel (`api/index.ts`) importa desde `./dist/serverless`
 * precisamente para que esbuild empaquete el JS ya compilado por tsc
 * (con design:paramtypes de los decoradores) y no recompile los fuentes.
 */
let cachedApp: NestExpressApplication | null = null
const expressApp = express()

export async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (!cachedApp) {
    cachedApp = await createApp(expressApp)
    await cachedApp.init()
  }
  expressApp(req, res)
}

export default handler