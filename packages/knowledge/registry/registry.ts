import type { CompiledKnowledgeRegistry } from './types';

export class KnowledgeRegistry {
  #compiled: CompiledKnowledgeRegistry | null = null;

  install(compiled: CompiledKnowledgeRegistry): CompiledKnowledgeRegistry {
    if (this.#compiled && this.#compiled.hash !== compiled.hash) {
      throw new Error('Knowledge registry is already installed with a different manifest hash.');
    }
    this.#compiled = compiled;
    return compiled;
  }

  current(): CompiledKnowledgeRegistry {
    if (!this.#compiled) throw new Error('Knowledge registry has not been compiled.');
    return this.#compiled;
  }

  type(key: string) {
    return this.current().entityTypes.get(key.toLowerCase());
  }

  predicate(key: string) {
    return this.current().predicates.get(key.toLowerCase());
  }

  projection(key: string) {
    return this.current().readProjections.get(key.toLowerCase());
  }

  profile(key: string) {
    return this.current().extractionProfiles.get(key.toLowerCase());
  }
}

export const knowledgeRegistry = new KnowledgeRegistry();
