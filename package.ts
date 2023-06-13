import p from "./dist/package.json";
import { writeFileSync } from "fs";

const data = JSON.stringify(
  {
    ...p,
    devDependencies: undefined,
    scripts: undefined,
  },
  null,
  "  "
);

writeFileSync("./dist/package.json", Buffer.from(data));
