import { Client } from "@elastic/elasticsearch";

let client: Client | null = null;

/**
 * Returns an Elasticsearch client when env is configured, otherwise null.
 * Missing config is intentional for local demos without Elastic.
 */
export function getElasticClient(): Client | null {
  const url = process.env.ELASTICSEARCH_URL;
  const apiKey = process.env.ELASTICSEARCH_API_KEY;

  if (!url) {
    return null;
  }

  if (!client) {
    client = new Client({
      node: url,
      ...(apiKey ? { auth: { apiKey } } : {}),
    });
  }

  return client;
}
