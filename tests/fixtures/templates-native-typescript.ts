import { getAppTemplates, type AppTemplatePath, type AppTemplateTree } from "../../lib/templates.ts";

const templates: AppTemplateTree = getAppTemplates("native-types", "2000-01-01T00:00:00.000Z");
const paths: AppTemplatePath[] = [
  "README.md",
  "package.json",
  "oaf/app.json",
  "oaf/stack.json",
  "oaf/docs-pack.json",
  "oaf/doctor.mjs",
  "oaf/receipts/.gitkeep",
  "tests/sanity.test.mjs",
  "tests/unit/.gitkeep",
  "tests/integration/.gitkeep",
  "e2e/.gitkeep",
  "public/.gitkeep",
  "app/layout.tsx",
  "app/page.tsx",
  "app/api/.gitkeep",
  "components/ui/.gitkeep",
  "components/shared/.gitkeep",
  "features/example-feature/components/.gitkeep",
  "features/example-feature/server/.gitkeep",
  "features/example-feature/schemas.ts",
  "features/example-feature/types.ts",
  "features/example-feature/index.ts",
  "lib/env.ts",
  "lib/result.ts",
  "lib/utils.ts",
  "server/auth/.gitkeep",
  "server/actions/.gitkeep",
  "db/schema/.gitkeep",
  "db/migrations/.gitkeep",
  "db/seed/.gitkeep",
  "db/client.ts",
  "docs/app.md",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
  "docker-compose.yml",
  "Dockerfile",
];

for (const path of paths) {
  const content: string = templates[path];
  if (typeof content !== "string") throw new Error("template values must be strings");
}
templates["README.md"] = "mutable";

// @ts-expect-error unknown template paths are rejected.
templates["unknown-path"];
// @ts-expect-error numeric names are rejected.
getAppTemplates(1, "2000-01-01T00:00:00.000Z");
// @ts-expect-error the createdAt argument is required.
getAppTemplates("native-types");
// @ts-expect-error nullable names are rejected.
getAppTemplates(null, "2000-01-01T00:00:00.000Z");
// @ts-expect-error arbitrary third arguments are rejected.
getAppTemplates("native-types", "2000-01-01T00:00:00.000Z", "extra");
// @ts-expect-error template values cannot be assigned to numbers.
const numberValue: number = templates["README.md"];
// @ts-expect-error object literals missing required template paths are rejected.
const missingPaths: AppTemplateTree = { "README.md": "" };
// @ts-expect-error object literals with extra template paths are rejected.
const extraPath: AppTemplateTree = { ...templates, "unknown-path": "" };

void numberValue;
void missingPaths;
void extraPath;
console.log("templates-native-typescript:ok");
