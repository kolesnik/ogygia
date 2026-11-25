declare module 'virtual:ogygia-image/config' {
	const config: import('./config.ts').RenderConfig;
	export default config;
}

declare module 'virtual:ogygia-image/sources' {
	/** Every image under `src/`, by its project path: its asset URL. */
	const sources: Record<string, string>;
	export default sources;
}
