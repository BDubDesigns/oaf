export interface SmokeInput {
  value: string;
}

export type SmokeOutput = {
  message: string;
};

export function formatSmoke({ value }: SmokeInput): SmokeOutput {
  return { message: `native-typescript:${value}` };
}
