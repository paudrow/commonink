# Math sampler

Inline math sits in its sentence: the energy of a mass is $E = mc^2$, and $`a_{1} * b_{2}`$ uses the backtick form for math markdown would otherwise read. Agents often write \(\alpha + \beta\) instead, which works too.

A block with dollars:

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

A `math` code block:

```math
\begin{pmatrix} a & b \\ c & d \end{pmatrix}^{-1} = \frac{1}{ad - bc} \begin{pmatrix} d & -b \\ -c & a \end{pmatrix}
```

And the bracket form:

\[
\sum_{k=1}^{n} k = \frac{n(n+1)}{2}
\]

Dollar signs that aren't math stay text: it costs $5 and $10, and \$20 is escaped.

This formula has a mistake, so it shows its source in red; hover it for why: $\frac{1}{$.
