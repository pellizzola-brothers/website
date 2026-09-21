using System;

namespace CShp_ForcaBruta
{
    // "static class" significa que essa classe não precisa ser "criada" (new Cracker()) —
    // ela existe uma única vez durante todo o programa, e todo mundo acessa as mesmas variáveis.
    static class Cracker
    {
        public static string password;        // a senha que o usuário digitou (o "alvo")
        public static int tamanhoSenha;        // tamanho da senha digitada (só pra exibir depois)
        public static int tamanhoAlvo;         // tamanho que está sendo testado AGORA na busca
        public static long tentativas = 0;     // contador: quantas combinações já foram testadas
        public static string charset = "0123456789abcdefghijklmnopqrstuvwxyz"; // alfabeto usado nas tentativas
        public static bool encontrada = false; // vira "true" assim que a senha certa é encontrada

        // Essa função testa combinações usando RECURSÃO (a função chama ela mesma).
        // "atual" é a senha parcial que está sendo montada, caractere por caractere.
        public static void QuebraSenha(string atual)
        {
            // Se já achou a senha em outra "ramificação" da busca, para tudo imediatamente.
            if (encontrada) return;

            // Caso base: a senha parcial já tem o tamanho que estamos testando.
            if (atual.Length == tamanhoAlvo)
            {
                tentativas++;               // conta mais uma tentativa
                if (atual == password)      // compara com a senha real
                {
                    encontrada = true;      // achou! marca a flag e sai
                }
                return;
            }

            // Caso ainda não montou uma senha do tamanho certo:
            // testa grudar cada caractere possível do charset na frente da senha parcial,
            // e chama a si mesma de novo (um passo mais fundo) pra continuar montando.
            //
            // Exemplo com charset "01" e tamanho 3:
            // "" -> "0" -> "00" -> "000" (testa) -> "001" (testa) -> volta -> "01" -> "010" (testa) ...
            foreach (char c in charset)
            {
                if (encontrada) return;     // corta o loop cedo se outra chamada já achou a senha
                QuebraSenha(atual + c);     // chamada recursiva: um caractere a mais
            }
        }
    }
}
