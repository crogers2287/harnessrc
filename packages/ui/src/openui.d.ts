// OpenUI 0.17 subpath declaration barrels use extensionless relative imports, which
// NodeNext cannot resolve. Reuse the package's bundled declarations while Vite
// imports only the standalone components (no chat runtime or model connection).
declare module '@openuidev/react-ui/Button' {
  export { Button } from '@openuidev/react-ui';
}
declare module '@openuidev/react-ui/IconButton' {
  export { IconButton } from '@openuidev/react-ui';
}
declare module '@openuidev/react-ui/TextArea' {
  export { TextArea } from '@openuidev/react-ui';
}
