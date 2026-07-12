import { formatSmoke, type SmokeInput } from "./node24-native-ts-smoke-helper.ts";

const input: SmokeInput = { value: "ok" };
console.log(formatSmoke(input).message);
