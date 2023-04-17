import { ImageDescriptor, ValueOf } from "../descriptor";
import * as expr from "../expr";
import { DESC, EXPR, Selector } from "./selector";

export class ImageSelector<Ctx> extends Selector<ImageDescriptor, Ctx> {
  constructor(readonly expr: expr.Expr<Ctx, ValueOf<ImageDescriptor>>) {
    super();
  }

  [EXPR](): expr.Expr<Ctx, ValueOf<ImageDescriptor>> {
    return this.expr;
  }
  [DESC](): ImageDescriptor {
    return ImageDescriptor;
  }
}

export function newImageSelector<Ctx>(
  expr: expr.Expr<Ctx, ValueOf<ImageDescriptor>>
): ImageSelector<Ctx> {
  return new ImageSelector(expr);
}
