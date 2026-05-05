declare module 'draco3dgltf' {
	interface DracoModuleFactory {
		createDecoderModule(): Promise<unknown>;
	}

	const factory: DracoModuleFactory;
	export default factory;
}
