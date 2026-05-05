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
	const itemNo = url.searchParams.get('itemNo')?.trim() ?? '';
	if (!itemNo) {
		return json({ error: 'Missing itemNo parameter.' }, { status: 400 });
	}

	const country = normalizeLocale(url.searchParams.get('country'), DEFAULT_COUNTRY);
	const language = normalizeLocale(url.searchParams.get('language'), DEFAULT_LANGUAGE);

	try {
		const api = new IkeaApiClient(country, language);
		const exists = await api.modelExists(itemNo);
		if (!exists) {
			return json({ exists: false });
		}
		const info = await api.getModelInfo(itemNo);
		return json({ exists: true, info });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Model lookup failed';
		return json(
			{ error: 'Unable to check model availability.', details: message },
			{ status: 502 }
		);
	}
};
