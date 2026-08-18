import { INestApplication } from '@nestjs/common'

/**
 * Supertest solo gestiona listen/close de forma segura para requests
 * secuenciales: si el servidor no está escuchando al construir un request,
 * supertest llama `listen(0)` y lo CIERRA tras cada respuesta
 * (`test.js:serverAddress` + `end`), re-abriendo en un puerto nuevo.
 * Con requests concurrentes en el mismo tick la construcción se dispara
 * con `address() === null` (múltiples `listen(0)` + lectura de puerto en
 * carrera con el bind) y algún request apunta a un puerto stale/cerrado,
 * produciendo `read ECONNRESET`. Pre-listen una sola vez antes de los tests
 * para que `address()` nunca sea null y el servidor permanezca estable.
 */
export async function listenForTests(app: INestApplication): Promise<void> {
  const server = app.getHttpServer()
  if (server.listening) return
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
}