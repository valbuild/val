# Val NextJS example

This is a Next JS project with Val enabled.

## File structure

The following files are required in Val NextJS project:

- `/val.config.ts` - this is the main Val config file
- `/app/(val)/api/val/[[...val]]/route.ts` - all API call to Val goes via these endpoints
- `/app/(val)/val/[[...val]]/page.tsx` - this is the URL to the Val full-screen app
- `/val/server.ts` - this is the helper library for server related functions

Additionally the following files are needed:

- `/val/client.ts` - this is the helper library for **Client Components**
- `/val/rsc.ts` - this is the helper library for **React Server Components**

### Content

Check out the `.val.ts` files where content is defined to learn more.
