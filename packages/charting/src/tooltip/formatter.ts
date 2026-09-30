/**
 * recharts 3.10 types the Tooltip `formatter` value as `ValueType`
 * (`number | string | readonly (number | string)[]`), but every chart in this
 * app feeds numeric data. This adapter narrows the contract back to numbers
 * while staying assignable to recharts' Tooltip formatter type, so each call
 * site keeps its `value: number | undefined` shape without per-chart casts.
 */

export type ChartTooltipFormatter = (
  value: number | string | readonly (number | string)[] | undefined,
  name: number | string | undefined
) => [string | number, string]

export function asNumericTooltipFormatter(
  fn: (
    value: number | undefined,
    name: string | undefined
  ) => [string | number, string]
): ChartTooltipFormatter {
  return (value, name) =>
    fn(
      typeof value === 'number'
        ? value
        : value == null
          ? undefined
          : Number(value),
      name == null ? undefined : String(name)
    )
}
