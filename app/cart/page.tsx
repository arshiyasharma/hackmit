import { redirect } from "next/navigation";

/**
 * There is no cart any more.
 *
 * The basket IS the set of objects standing in the room that have a listing
 * linked to them, and /checkout is the one screen that reviews it. This route
 * only exists because v2's links and anyone's browser history point at it —
 * it forwards rather than leaving two competing review screens in the tree.
 */
export default function CartPage(): never {
  redirect("/checkout");
}
