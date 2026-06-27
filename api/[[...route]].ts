import { handle } from "hono/vercel";
import { app } from "../src/server/index";

export const config = {
  runtime: "nodejs",
};

export default handle(app);
