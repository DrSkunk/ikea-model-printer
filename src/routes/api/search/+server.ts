import { json } from '@sveltejs/kit';
import { IkeaApiClient, isValidLocaleCode } from '$lib/server/ikea-api';
import type { RequestHandler } from './$types';

const DEFAULT_COUNTRY = 'us';
const DEFAULT_LANGUAGE = 'en';

function normalizeLocale(value: string | null, fallback: string): string {
	const lower = value?.toLowerCase() ?? fallback;
	return isValidLocaleCode(lower) ? lower : fallback;
}

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q')?.trim() ?? '';
	if (!query) {
		return json({ products: [] });
	}

	const country = normalizeLocale(url.searchParams.get('country'), DEFAULT_COUNTRY);
	const language = normalizeLocale(url.searchParams.get('language'), DEFAULT_LANGUAGE);

	try {
		const api = new IkeaApiClient(country, language);
		const products = await api.search(query);
		return json({ products });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Search failed';
		return json({ error: 'Unable to search IKEA right now.', details: message }, { status: 502 });
	}
};
