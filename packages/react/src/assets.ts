import * as base64 from "base64-arraybuffer";

function dataUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${base64.encode(
    new TextEncoder().encode(data).buffer,
  )}`;
}

// TODO: stroke should be currentColor
export const editIcon = (size: number, stroke: string) =>
  dataUrl(
    "image/svg+xml",
    `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-edit"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
   `,
  );

export const logo = dataUrl(
  "image/svg+xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape (http://www.inkscape.org/) -->

<svg
   width="101.83195mm"
   height="103.55328mm"
   viewBox="0 0 101.83195 103.55328"
   version="1.1"
   id="svg974"
   inkscape:export-filename="logo.svg"
   inkscape:export-xdpi="96"
   inkscape:export-ydpi="96"
   xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"
   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"
   xmlns="http://www.w3.org/2000/svg"
   xmlns:svg="http://www.w3.org/2000/svg">
  <sodipodi:namedview
     id="namedview976"
     pagecolor="#ffffff"
     bordercolor="#000000"
     borderopacity="0.25"
     inkscape:showpageshadow="2"
     inkscape:pageopacity="0.0"
     inkscape:pagecheckerboard="0"
     inkscape:deskcolor="#d1d1d1"
     inkscape:document-units="mm"
     showgrid="false"
     inkscape:zoom="1.4040232"
     inkscape:cx="39.173141"
     inkscape:cy="503.90904"
     inkscape:window-width="3832"
     inkscape:window-height="2087"
     inkscape:window-x="0"
     inkscape:window-y="69"
     inkscape:window-maximized="1"
     inkscape:current-layer="layer1" />
  <defs
     id="defs971" />
  <g
     inkscape:label="Layer 1"
     inkscape:groupmode="layer"
     id="layer1"
     transform="translate(-46.162121,-16.863144)">
    <ellipse
       style="fill:#000000;fill-opacity:1;stroke:#000000;stroke-width:4.41854;stroke-dasharray:none;stroke-opacity:1"
       id="path2242"
       ry="49.567371"
       rx="48.706703"
       cy="68.639786"
       cx="97.078094" />
    <path
       style="fill:#000000;fill-opacity:1;stroke:#f2f2f2;stroke-width:9.9912;stroke-dasharray:none;stroke-opacity:1"
       d="m 65.105895,44.462411 18.85692,45.934668 13.064363,-39.90188 15.829132,39.947835 23.07956,-0.1822"
       id="path4245"
       sodipodi:nodetypes="ccccc" />
    <path
       style="fill:#000000;fill-opacity:1;stroke:#f2f2f2;stroke-width:4.85097;stroke-dasharray:none;stroke-opacity:1"
       d="M 108.18755,79.963752 C 101.58768,84.940963 94.021144,82.50121 86.406627,79.693345"
       id="path4249"
       sodipodi:nodetypes="cc" />
  </g>
</svg>`,
);

export const valcmsLogo = dataUrl(
  "image/svg+xml",
  `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg
   xmlns:dc="http://purl.org/dc/elements/1.1/"
   xmlns:cc="http://creativecommons.org/ns#"
   xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
   xmlns:svg="http://www.w3.org/2000/svg"
   xmlns="http://www.w3.org/2000/svg"
   width="20"
   height="20"
   viewBox="0 0 52.916665 52.916668"
   version="1.1"
   id="svg8">
  <defs
     id="defs2" />
  <metadata
     id="metadata5">
    <rdf:RDF>
      <cc:Work
         rdf:about="">
        <dc:format>image/svg+xml</dc:format>
        <dc:type
           rdf:resource="http://purl.org/dc/dcmitype/StillImage" />
        <dc:title></dc:title>
      </cc:Work>
    </rdf:RDF>
  </metadata>
  <g
     id="layer1">
    <path
       style="fill:none;stroke:white;stroke-width:5.00377;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1"
       d="M 3.9337727,9.883415 14.718441,43.556958 25.597715,9.9678121 35.530965,43.388176 h 15.798599 v 0 h 0.09461"
       id="path10" />
    <path
       style="fill:none;stroke:white;stroke-width:5.00377;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-opacity:1"
       d="m 19.826972,27.859518 11.257682,0.0844 v 0 0"
       id="path837" />
  </g>
</svg>`,
);
