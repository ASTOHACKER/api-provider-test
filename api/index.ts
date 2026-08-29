import { handle } from "hono/vercel"
import { createApp } from "../src/app.js"

const app = createApp()

export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const PATCH = handle(app)
export const DELETE = handle(app)
export const OPTIONS = handle(app)
