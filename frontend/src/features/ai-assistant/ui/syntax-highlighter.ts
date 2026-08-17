// @ts-expect-error - react-syntax-highlighter module interop
import { PrismAsyncLight } from "react-syntax-highlighter";
import { makePrismAsyncLightSyntaxHighlighter } from "@assistant-ui/react-syntax-highlighter";

// @ts-expect-error - no type declarations for this subpath
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
// @ts-expect-error - no type declarations for this subpath
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";

// @ts-expect-error - no type declarations for this subpath
import { coldarkCold } from "react-syntax-highlighter/dist/cjs/styles/prism";

// register languages you want to support
PrismAsyncLight.registerLanguage("js", tsx);
PrismAsyncLight.registerLanguage("jsx", tsx);
PrismAsyncLight.registerLanguage("ts", tsx);
PrismAsyncLight.registerLanguage("tsx", tsx);
PrismAsyncLight.registerLanguage("python", python);

export const SyntaxHighlighter = makePrismAsyncLightSyntaxHighlighter({
    style: coldarkCold,
    customStyle: {
        margin: 0,
        width: "100%",
        background: "#f5f5f5",
        padding: "1.5rem 1rem",
    },
});

