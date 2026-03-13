---
paths:
  - 'packages/client/**/*.{ts,tsx}'
---

# Client Package Rules

## Components

- Use functional components with hooks. No class components.
- Keep components focused — one responsibility per component.
- Co-locate component-specific types in the same file.

## 3D / React Three Fiber

- Use React Three Fiber declarative JSX for 3D scene elements.
- Use Drei helpers (Html, Billboard, OrbitControls) where available.
- Keep the render loop lean — avoid expensive computations in useFrame callbacks.

## State

- UI state from the server comes via WebSocket. Do not poll REST endpoints for real-time data.
- REST endpoints are for user-initiated actions (pause, resume, speed change, send message).

## Styling

- No global CSS class names that could collide. Use CSS modules or inline styles.
