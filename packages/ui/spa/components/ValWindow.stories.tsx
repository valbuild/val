import type {
  Meta,
  //  StoryObj
} from "@storybook/react";
// import { RichTextEditor } from "../exports";

import { ValWindow } from "./ValWindow";

const meta: Meta<typeof ValWindow> = { component: ValWindow };

export default meta;
// type Story = StoryObj<typeof ValWindow>;

// const EXAMPLE_IMAGE =
//   "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAFgAWAAD/4QDkRXhpZgAASUkqAAgAAAAJABIBAwABAAAAAQAAABoBBQABAAAAegAAABsBBQABAAAAggAAACgBAwABAAAAAgAAADEBAgANAAAAigAAADIBAgAUAAAAmAAAAGmHBAABAAAAygAAAHySAgAHAAAArAAAAIaSAgAWAAAAtAAAAAAAAAAWAAAAAQAAABYAAAABAAAAR0lNUCAyLjEwLjM0AAAyMDIzOjA1OjI0IDE0OjQ3OjA1AE9wZW5BSQAATWFkZSB3aXRoIE9wZW5BSSBMYWJzAAEAAaADAAEAAAABAAAAAAAAAP/hDM9odHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IlhNUCBDb3JlIDQuNC4wLUV4aXYyIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wTU09Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9tbS8iIHhtbG5zOnN0RXZ0PSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvc1R5cGUvUmVzb3VyY2VFdmVudCMiIHhtbG5zOmRjPSJodHRwOi8vcHVybC5vcmcvZGMvZWxlbWVudHMvMS4xLyIgeG1sbnM6R0lNUD0iaHR0cDovL3d3dy5naW1wLm9yZy94bXAvIiB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iIHhtcE1NOkRvY3VtZW50SUQ9ImdpbXA6ZG9jaWQ6Z2ltcDo1NDk5MWU4Yy01YjkxLTQwYWYtYjk4ZC00ZjEwMWYwY2QxZWQiIHhtcE1NOkluc3RhbmNlSUQ9InhtcC5paWQ6Y2JmMjFlNjMtNGZiYi00MjI5LThlM2UtN2MzMWI0ZDNiNWFhIiB4bXBNTTpPcmlnaW5hbERvY3VtZW50SUQ9InhtcC5kaWQ6YzQ3ZWZmNDktNzg4Yy00NzdjLWJkNTEtZGM5YzJjYTY4NzBjIiBkYzpGb3JtYXQ9ImltYWdlL2pwZWciIEdJTVA6QVBJPSIyLjAiIEdJTVA6UGxhdGZvcm09IkxpbnV4IiBHSU1QOlRpbWVTdGFtcD0iMTY4NDkzMjQyNzk4NDA2MCIgR0lNUDpWZXJzaW9uPSIyLjEwLjM0IiB4bXA6Q3JlYXRvclRvb2w9IkdJTVAgMi4xMCIgeG1wOk1ldGFkYXRhRGF0ZT0iMjAyMzowNToyNFQxNDo0NzowNSswMjowMCIgeG1wOk1vZGlmeURhdGU9IjIwMjM6MDU6MjRUMTQ6NDc6MDUrMDI6MDAiPiA8eG1wTU06SGlzdG9yeT4gPHJkZjpTZXE+IDxyZGY6bGkgc3RFdnQ6YWN0aW9uPSJzYXZlZCIgc3RFdnQ6Y2hhbmdlZD0iLyIgc3RFdnQ6aW5zdGFuY2VJRD0ieG1wLmlpZDoxNjIyMWEyMS0wZmMzLTQ1NmEtOWZlOC1hOTAyMmY0NjBhOTEiIHN0RXZ0OnNvZnR3YXJlQWdlbnQ9IkdpbXAgMi4xMCAoTGludXgpIiBzdEV2dDp3aGVuPSIyMDIzLTA1LTI0VDE0OjQ3OjA3KzAyOjAwIi8+IDwvcmRmOlNlcT4gPC94bXBNTTpIaXN0b3J5PiA8L3JkZjpEZXNjcmlwdGlvbj4gPC9yZGY6UkRGPiA8L3g6eG1wbWV0YT4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8P3hwYWNrZXQgZW5kPSJ3Ij8+/+ICsElDQ19QUk9GSUxFAAEBAAACoGxjbXMEQAAAbW50clJHQiBYWVogB+cABQAYAAwALQAJYWNzcEFQUEwAAAAAAAAA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";
// const EXAMPLE_TEXT = `
// Vi gjør mange ting sammen i Blank, men det vi lever av er å designe og utvikle digitale tjenester for kundene våre.

// Noen av selskapene vi jobber med er små, andre er store. Alle har de høye ambisjoner for sine digitale løsninger, og stiller høye krav til hvem de jobber med.

// Noen ganger starter vi nye, egne, selskaper også, mest fordi det er gøy (og fordi vi liker å bygge ting), men også fordi smarte folk har gode idéer som fortjener å bli realisert.
// Ting vi har bygd for kundene våre
// `;
// export const ShortText: Story = {
//   args: {
//     isInitialized: true,
//     children: (
//       <FormContainer
//         onSubmit={() => {
//           /* */
//         }}
//       >
//         <TextArea
//           name="/apps/blogs.0.title"
//           text="Hva skjer'a, Bagera?"
//           onChange={() => {
//             console.log("onChange");
//           }}
//         />
//       </FormContainer>
//     ),
//   },
// };
// export const LongText: Story = {
//   args: {
//     isInitialized: true,
//     children: (
//       <FormContainer
//         onSubmit={() => {
//           /* */
//         }}
//       >
//         <div className="h-full grid grid-rows-[1fr,_min-content] ">
//           <TextArea
//             name="/apps/blogs.0.title"
//             text={EXAMPLE_TEXT}
//             onChange={() => {
//               console.log("onChange");
//             }}
//           />
//         </div>
//       </FormContainer>
//     ),
//   },
// };

// export const RichText: Story = {
//   args: {
//     isInitialized: true,
//     children: (
//       <FormContainer
//         onSubmit={() => {
//           /* */
//         }}
//       >
//         <RichTextEditor
//           richtext={{
//             _type: "richtext",
//             templateStrings: ["# Title 1"],
//             exprs: [],
//           }}
//         />
//       </FormContainer>
//     ),
//   },
// };

// export const EmptyImage: Story = {
//   args: {
//     isInitialized: true,
//     children: (
//       <FormContainer
//         onSubmit={() => {
//           /* */
//         }}
//       >
//         <ImageForm
//           name="/apps/blogs.0.image"
//           error={null}
//           data={null}
//           onChange={() => {
//             console.log("onChange");
//           }}
//         />
//       </FormContainer>
//     ),
//   },
// };

// export const Image: Story = {
//   args: {
//     isInitialized: true,
//     children: (
//       <div className="h-full grid grid-rows-[1fr,_min-content] overflow-scroll">
//         <img src={EXAMPLE_IMAGE} />
//         <div className="flex justify-end">
//           <button className="px-4 py-2 border border-highlight">Submit</button>
//         </div>
//       </div>
//     ),
//   },
// };

// export const ImageError: Story = {
//   args: {
//     isInitialized: true,
//     children: (
//       <FormContainer
//         onSubmit={() => {
//           /* */
//         }}
//       >
//         <ImageForm
//           name="/apps/blogs.0.image"
//           error={"invalid-file"}
//           data={{
//             url: EXAMPLE_IMAGE,
//           }}
//           onChange={() => {
//             console.log("onChange");
//           }}
//         />
//       </FormContainer>
//     ),
//   },
// };
