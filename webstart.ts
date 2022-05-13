import {BasicREPL} from './repl';
import { Type, Value } from './ast';
import { defaultTypeEnv } from './type-check';
import { NUM, BOOL, NONE } from './utils';
import CodeMirror from "codemirror";
import "./style.scss";

export type ObjectField = 
|{field: string, value: Value}
|{field: string, value: Array<ObjectField>, type: Value}

function stringify(typ: Type, arg: any) : string {
  switch(typ.tag) {
    case "number":
      return (arg as number).toString();
    case "bool":
      return (arg as boolean)? "True" : "False";
    case "none":
      return "None";
    case "class":
      return typ.name;
  }
}

function print(typ: Type, arg : number) : any {
  console.log("Logging from WASM: ", arg);
  const elt = document.createElement("pre");
  document.getElementById("output").appendChild(elt);
  elt.innerText = stringify(typ, arg);
  return arg;
}

function assert_not_none(arg: any) : any {
  if (arg === 0)
    throw new Error("RUNTIME ERROR: cannot perform operation on none");
  return arg;
}

function getObject(result: Value, view: Int32Array, relp: BasicREPL): Array<ObjectField>{
  let list = new Array<ObjectField>();
  if(result.tag === "bool" || result.tag === "none" || result.tag === "num"){
    return list;
  }

  list.push({field: "address", value: {tag:"num", value: result.address}});
  //get the field of object
  const fields = relp.currentTypeEnv.classes.get(result.name)[0];
  let index = result.address / 4;
  fields.forEach((value: Type, key: string) => {
    switch(value.tag){
      case "number":
        list.push({field: key, value: {tag: "num", value: view.at(index)}});
        break;
      case "bool":
        list.push({field: key, value: {tag: "bool", value: Boolean(view.at(index))}});
        break;
      case "none":
        list.push({field: key, value: {tag: "none", value: view.at(index)}});
        break;
      case "class":
        const objectResult : Value = {tag: "object", name: value.name, address: view.at(index)};
        const fieldList = getObject(objectResult, view, relp);
        list.push({field: key, value: fieldList, type: objectResult});
        break;
    }
    index += 1
  });

  return list;
}

function webStart() {
  var filecontent: string | ArrayBuffer;
  document.addEventListener("DOMContentLoaded", async function() {

    // https://github.com/mdn/webassembly-examples/issues/5

    const memory = new WebAssembly.Memory({initial:10, maximum:100});
    const memoryModule = await fetch('memory.wasm').then(response => 
      response.arrayBuffer()
    ).then(bytes => 
      WebAssembly.instantiate(bytes, { js: { mem: memory } })
    );

    var importObject = {
      imports: {
        assert_not_none: (arg: any) => assert_not_none(arg),
        print_num: (arg: number) => print(NUM, arg),
        print_bool: (arg: number) => print(BOOL, arg),
        print_none: (arg: number) => print(NONE, arg),
        abs: Math.abs,
        min: Math.min,
        max: Math.max,
        pow: Math.pow
      },
      libmemory: memoryModule.instance.exports,
      memory_values: memory,
      js: {memory: memory}
    };
    var repl = new BasicREPL(importObject);

    function renderResult(result : Value) : void {
      if(result === undefined) { console.log("skip"); return; }
      if (result.tag === "none") return;
      const elt = document.createElement("pre");
      document.getElementById("output").appendChild(elt);
      switch (result.tag) {
        case "num":
          elt.innerText = String(result.value);
          break;
        case "bool":
          elt.innerHTML = (result.value) ? "True" : "False";
          break;
        case "object":
          elt.innerHTML = `<${result.name} object at ${result.address}`
          break
        default: throw new Error(`Could not render value: ${result}`);
      }
    }

    function renderError(result : any) : void {
      const elt = document.createElement("pre");
      document.getElementById("output").appendChild(elt);
      elt.setAttribute("style", "color: red");
      elt.innerText = String(result);
    }

    function setupRepl() {
      document.getElementById("output").innerHTML = "";
      const replCodeElement = document.getElementById("next-code") as HTMLTextAreaElement;
      replCodeElement.addEventListener("keypress", (e) => {

        if(e.shiftKey && e.key === "Enter") {
        } else if (e.key === "Enter") {
          e.preventDefault();
          const output = document.createElement("div");
          const prompt = document.createElement("span");
          prompt.innerText = "»";
          output.appendChild(prompt);
          const elt = document.createElement("textarea");
          // elt.type = "text";
          elt.disabled = true;
          elt.className = "repl-code";
          output.appendChild(elt);
          document.getElementById("output").appendChild(output);
          const source = replCodeElement.value;
          elt.value = source;
          replCodeElement.value = "";
          repl.run(source).then((r) => { 
            console.log(r);
            renderResult(r); console.log ("run finished") })
              .catch((e) => { renderError(e); console.log("run failed", e) });;
        }
      });
    }

    function resetRepl() {
      document.getElementById("output").innerHTML = "";
    }

    document.getElementById("run").addEventListener("click", function(e) {
      repl = new BasicREPL(importObject);
      const source = document.getElementById("user-code") as HTMLTextAreaElement;
      resetRepl();
      console.log(source);
      repl.run(source.value).then((r) => {
        console.log(r); 
        console.log(repl.getHeap());
        console.log(getObject(r, repl.getHeap(), repl));
        renderResult(r); 
        console.log ("run finished") 
        
      })
        .catch((e) => { renderError(e); console.log("run failed", e) });;
    });

    document.getElementById("choose_file").addEventListener("change", function (e) {
      //load file
      var input: any = e.target;
      var reader = new FileReader();
      reader.onload = function () {
        filecontent = reader.result;
      };
      reader.readAsText(input.files[0]);
    });

    document.getElementById("load").addEventListener("click", function (e) {
      //clear repl output
      resetRepl();
      //reset environment
      repl = new BasicREPL(importObject);
      // Repalce text area with the content in the uploaded file
      const source = document.getElementById("user-code") as HTMLTextAreaElement;
      source. value = filecontent.toString();
    });

    document.getElementById("save").addEventListener("click", function (e) {
      //download the code in the user-code text area
      var FileSaver = require("file-saver");
      var title = (document.getElementById("save_title") as any).value;
      const source = document.getElementById("user-code") as HTMLTextAreaElement;
      var blob = new Blob([source.value], { type: "text/plain;charset=utf-8" });
      FileSaver.saveAs(blob, title);
    });
    
    setupRepl();
  });
}

webStart();
