/**
 * Entry de Vercel. Importa el handler desde el dist COMPILADO por `nest build`
 * (tsc) para que esbuild de @vercel/node empaquete el JS con el metadata de
 * decoradores (design:paramtypes) que NestJS necesita para la DI.
 *
 * Si se importara desde `src`, esbuild recompilaría los .ts sin
 * emitDecoratorMetadata y la inyección de dependencias rompería en runtime
 * ("Nest can't resolve dependencies").
 */
import 'reflect-metadata'
export { default, handler } from './dist/serverless'