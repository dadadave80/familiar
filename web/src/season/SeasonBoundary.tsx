import { Component, type ReactNode } from "react";
import "./season.css";

export default class SeasonBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<p className="ss-problem" role="alert">Bram’s shelf won’t open just now. Reload the page to try again.</p>:this.props.children;}
}
