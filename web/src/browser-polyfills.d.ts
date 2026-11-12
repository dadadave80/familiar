declare module "process/browser.js" {
  const browserProcess:{env:Record<string,string|undefined>};
  export default browserProcess;
}
