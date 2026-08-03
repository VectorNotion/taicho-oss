import {
  getProjectById,
  getProjectEntities,
  getProjects,
} from '../data/project-repository';

export interface ProjectProofRef {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  processed?: boolean | null;
}

export interface ProjectProof extends ProjectProofRef {
  tags: string[];
  entities: Array<{
    type: string;
    name: string;
    relationship: string;
  }>;
}

export async function listProjectProofs(query?: string, limit = 10): Promise<ProjectProofRef[]> {
  const projects = await getProjects();
  const normalizedQuery = query?.trim().toLowerCase();

  return projects
    .filter((project) => {
      if (!normalizedQuery) return true;
      return `${project.title} ${project.description || ''}`.toLowerCase().includes(normalizedQuery);
    })
    .slice(0, limit)
    .map((project) => ({
      id: project.id,
      title: project.title,
      description: project.description,
      status: null,
      processed: project.processed,
    }));
}

export async function getProjectProof(projectId: string): Promise<ProjectProof | null> {
  const [project, entities] = await Promise.all([
    getProjectById(projectId),
    getProjectEntities(projectId),
  ]);

  if (!project) return null;

  return {
    id: project.id,
    title: project.title,
    description: project.description,
    status: null,
    processed: null,
    tags: project.tags || [],
    entities,
  };
}
