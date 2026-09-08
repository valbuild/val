---
"@valbuild/ui": patch
---

Two fixes to the Studio's chrome

**Data, Media and Settings are reachable again on a tablet.** The left rail is
drawn from 1200px up, and the top bar's menu button opens the first destination
a project has and nothing else — so between 768px and 1200px, which is an iPad
in either orientation and any half screen, whichever panel happened to be open
was the only panel you could reach. The destination switcher that stands in for
the rail was shown below 768px only, and the tablet width fell through the gap
between the two. It is now shown at every width where the rail is not.

**Review moved to the left of Preview.** The three actions read left to right
in the order they are done in — Review, Preview, Publish — instead of putting
the first step between the other two.
