import { createProvider } from "@earendil-works/pi-ai";
import type { ProviderStreams } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const JEV_PROVIDER_ID = "jev-response-router";

function unsupportedModelStream(): never {
  throw new Error("The Jev response router provider is auth-only and has no chat models.");
}

const authOnlyApi: ProviderStreams = {
  stream: unsupportedModelStream,
  streamSimple: unsupportedModelStream,
};

export function registerJevAuthProvider(pi: ExtensionAPI): void {
  pi.registerProvider(
    createProvider({
      id: JEV_PROVIDER_ID,
      name: "TypeSafe Jev (response router)",
      baseUrl: "https://api.typesafe.ai",
      auth: {
        apiKey: {
          name: "TypeSafe Jev API key",
          async login(interaction) {
            return {
              type: "api_key",
              key: await interaction.prompt({
                type: "secret",
                message: "TypeSafe Jev API key",
              }),
            };
          },
          async resolve({ credential, ctx }) {
            if (credential?.key) {
              return {
                auth: { apiKey: credential.key },
                source: "stored TypeSafe Jev API key",
              };
            }

            const envKey = await ctx.env("TYPESAFE_API_KEY");
            return envKey
              ? {
                  auth: { apiKey: envKey },
                  source: "TYPESAFE_API_KEY",
                }
              : undefined;
          },
        },
      },
      models: [],
      // Jev is NOT invoked through this API implementation. The provider exists
      // only so Pi can own /login, credential storage, and auth resolution.
      api: authOnlyApi,
    }),
  );
}
