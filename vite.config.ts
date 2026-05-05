import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		// Intercept virtual CSS modules from node_modules Svelte components before
		// @tailwindcss/vite reads the raw .svelte file and chokes on script content.
		{
			name: 'extract-node-modules-svelte-css',
			enforce: 'pre',
			async load(id) {
				if (
					id.includes('node_modules') &&
					id.includes('.svelte') &&
					id.includes('type=style')
				) {
					const { readFileSync } = await import('fs');
					const filePath = id.split('?')[0];
					const source = readFileSync(filePath, 'utf-8');
					const match = source.match(/<style[^>]*>([\s\S]*?)<\/style>/);
					if (!match) return '';
					// Strip :global() wrappers — they're Svelte-specific and lightningcss rejects them
					return match[1].replace(/:global\(([^)]+)\)/g, '$1');
				}
			}
		},
		sveltekit(),
		tailwindcss()
	]
});
