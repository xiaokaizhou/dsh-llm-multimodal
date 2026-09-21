/**
 * Output routing tests — "write generated media straight into the active
 * media-studio project" behaviour (docs/direct-output-design.md 方案 B/D).
 *
 * Covers the pure routing helpers exported from lib/index.js:
 *   - getMediaStudioService  (soft cross-plugin lookup, never throws)
 *   - resolveOutputStrategy  (default "project", legacy "outputDir")
 *   - resolveMediaDestination (project-scoped dir vs outputDir fallback)
 *   - projectScopedFields    (response envelope: projectId/assetKind/canvasUrl)
 *
 * No network, no cordis host: ctx is a plain object with/without `get`,
 * the media-studio service is a fake, the settings scope is a closure.
 */

import { describe, it, expect } from 'vitest'
import {
  MEDIA_STUDIO_CATEGORY_DIR,
  getMediaStudioService,
  resolveOutputStrategy,
  resolveMediaDestination,
  projectScopedFields,
} from '../lib/index.js'

function fakeStudio(overrides: {
  activeId?: string | null
  dir?: string | null
} = {}) {
  const activeId = overrides.activeId !== undefined ? overrides.activeId : "p-test"
  const dir = overrides.dir !== undefined ? overrides.dir : "/tmp/proj/assets/characters"
  return {
    getActiveProjectId: () => activeId,
    getActiveProject: () => (activeId ? { id: activeId, name: "test", sourcePath: "/tmp/proj" } : null),
    // The real service returns <root>/assets/<catDir>; emulate per-kind.
    resolveAssetDir: (projectId?: string, kind?: string) =>
      dir === null ? null : dir.replace(/\/[^/]+$/, "/" + MEDIA_STUDIO_CATEGORY_DIR[kind || "character"]),
    workspaceRoot: () => "/tmp/ws",
  }
}

function fakeScope(values: Record<string, unknown> = {}) {
  return {
    get: () => values,
    watch: () => () => {},
    update: async () => {},
    replace: async () => {},
  }
}

describe("getMediaStudioService — soft cross-plugin lookup", () => {
  it("returns the service when ctx.get provides it", () => {
    const svc = fakeStudio()
    expect(getMediaStudioService({ get: () => svc } as never)).toBe(svc)
  })

  it("returns null when the ctx has no lookup surface", () => {
    expect(getMediaStudioService({} as never)).toBeNull()
    expect(getMediaStudioService(null as never)).toBeNull()
  })

  it("returns null when the lookup throws (host surface degraded)", () => {
    const ctx = {
      get: () => {
        throw new Error("nope")
      },
    }
    expect(getMediaStudioService(ctx as never)).toBeNull()
  })

  it("returns the service via ctx.reflect.get when ctx.get is absent", () => {
    const svc = fakeStudio()
    const ctx = { reflect: { get: () => svc } }
    expect(getMediaStudioService(ctx as never)).toBe(svc)
  })
})

describe("resolveOutputStrategy", () => {
  it("defaults to project when unset", () => {
    expect(resolveOutputStrategy(fakeScope({}))).toBe("project")
    expect(resolveOutputStrategy(null as never)).toBe("project")
  })

  it("honours explicit legacy values", () => {
    expect(resolveOutputStrategy(fakeScope({ outputStrategy: "outputDir" }))).toBe("outputDir")
    expect(resolveOutputStrategy(fakeScope({ outputStrategy: "web-jobs" }))).toBe("outputDir")
  })
})

describe("resolveMediaDestination", () => {
  it("routes image/video/audio into the active project by default", () => {
    const ctx = { get: () => fakeStudio() }
    const scope = fakeScope({})
    expect(resolveMediaDestination(ctx as never, scope, "image")).toMatchObject({
      projectScoped: true,
      projectId: "p-test",
      category: "character",
      dir: "/tmp/proj/assets/characters",
    })
    expect(resolveMediaDestination(ctx as never, scope, "video").dir).toBe("/tmp/proj/assets/clips")
    expect(resolveMediaDestination(ctx as never, scope, "audio").dir).toBe("/tmp/proj/assets/audio")
  })

  it("honours the generate_image asset_kind override", () => {
    const ctx = { get: () => fakeStudio() }
    expect(resolveMediaDestination(ctx as never, fakeScope({}), "image", "scene").dir).toBe("/tmp/proj/assets/scenes")
  })

  it("falls back to outputDir when the service is absent", () => {
    const scope = fakeScope({ outputDir: "/tmp/out" })
    const r = resolveMediaDestination({} as never, scope, "image")
    expect(r).toMatchObject({ projectScoped: false, dir: "/tmp/out" })
  })

  it("falls back to /tmp when outputDir is also empty", () => {
    const r = resolveMediaDestination({} as never, fakeScope({}), "video")
    expect(r).toMatchObject({ projectScoped: false, dir: "/tmp" })
  })

  it("falls back to outputDir when media-studio has no active project", () => {
    const ctx = { get: () => fakeStudio({ activeId: null, dir: null }) }
    const r = resolveMediaDestination(ctx as never, fakeScope({ outputDir: "/tmp/out" }), "audio")
    expect(r).toMatchObject({ projectScoped: false, dir: "/tmp/out" })
  })

  it("legacy strategy always uses outputDir even with an active project", () => {
    const ctx = { get: () => fakeStudio() }
    const scope = fakeScope({ outputDir: "/tmp/out", outputStrategy: "outputDir" })
    expect(resolveMediaDestination(ctx as never, scope, "image")).toMatchObject({
      projectScoped: false,
      dir: "/tmp/out",
    })
  })
})

describe("projectScopedFields — response envelope", () => {
  it("emits projectId/assetKind/canvasUrl for project-scoped files", () => {
    const destInfo = { dir: "/tmp/proj/assets/clips", projectId: "p-1", category: "clip", projectScoped: true }
    expect(projectScopedFields(destInfo, "llm-multimodal-1-x.mp4")).toEqual({
      projectId: "p-1",
      assetKind: "clip",
      canvasUrl: "projects/p-1/assets/clips/llm-multimodal-1-x.mp4",
    })
  })

  it("stays empty for outputDir files or missing file names", () => {
    const fallback = { dir: "/tmp", projectId: null, category: null, projectScoped: false }
    expect(projectScopedFields(fallback, "x.png")).toEqual({})
    const broken = { dir: "/p", projectId: "p-1", category: "clip", projectScoped: true }
    expect(projectScopedFields(broken, null)).toEqual({})
    expect(projectScopedFields(null, "x.png")).toEqual({})
  })
})
