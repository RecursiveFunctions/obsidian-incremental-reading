import { Plugin } from "obsidian";

export default class IncrementalReadingPlugin extends Plugin {
  async onload() {
    console.log("[Incremental Reading] plugin loaded");
  }

  onunload() {
    console.log("[Incremental Reading] plugin unloaded");
  }
}
