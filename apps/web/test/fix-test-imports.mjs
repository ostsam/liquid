import { globSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.cwd(), ".test-dist");
const files = globSync("**/*.js", { cwd: root }).map((file) => path.join(root, file));

for (const file of files) {
  const source = await readFile(file, "utf8");
  const rewritten = source.replace(
    /(from\s+["'])(\.\.?\/[^"']+)(["'])/g,
    (full, prefix, specifier, suffix) => {
      if (specifier.endsWith(".js") || specifier.endsWith(".json")) {
        return full;
      }

      return `${prefix}${specifier}.js${suffix}`;
    },
  );

  if (rewritten !== source) {
    await writeFile(file, rewritten);
  }
}
