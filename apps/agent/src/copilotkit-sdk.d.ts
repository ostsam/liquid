// @copilotkit/sdk-js ships langgraph.js without a corresponding .d.ts file.
// This declaration shim satisfies TypeScript's module resolver.
// The actual runtime exports are correct — this is purely for type checking.
declare module "@copilotkit/sdk-js/langgraph" {
  import type { RunnableConfig } from "@langchain/core/runnables";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const CopilotKitStateAnnotation: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function convertActionsToDynamicStructuredTools(actions: any[]): any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function copilotkitEmitState(config: RunnableConfig, state: any): Promise<void>;
}
