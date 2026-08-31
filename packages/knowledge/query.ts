import type { ContextBundle } from './domain';
import type { KnowledgePolicyContext } from './policy';
import type { ContextQuery, Explanation, KnowledgeRepository } from './repository';

export async function queryKnowledgeContext(repository: KnowledgeRepository, query: ContextQuery): Promise<ContextBundle> {
  return repository.queryContext(query);
}

export async function explainKnowledge(repository: KnowledgeRepository, id: string, policy: KnowledgePolicyContext): Promise<Explanation | null> {
  return repository.explain(id, policy);
}
