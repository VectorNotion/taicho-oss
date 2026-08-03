import { NextRequest, NextResponse } from 'next/server';
import { createProject, getProjects } from '@/products/content-generator/data/project-repository';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { title, description, tags, demoUrl, githubUrl, liveUrl, docsUrl } = body;

    // Validate required fields
    if (!title || !description) {
      return NextResponse.json(
        { error: 'Title and description are required' },
        { status: 400 }
      );
    }

    // Create project in Neo4j
    const project = await createProject({
      title,
      description,
      tags: tags || [],
      demoUrl,
      githubUrl,
      liveUrl,
      docsUrl,
    });

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const projects = await getProjects();
    return NextResponse.json(projects);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json(
      { error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}
